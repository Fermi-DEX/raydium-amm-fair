use crate::{errors::RelayerError, SwapRequest};
use anyhow::Result;
use sled::Db;
use std::collections::VecDeque;

/// Tracks the sequence number used for FIFO ordering and maintains
/// a queue of pending swaps.  The `current_sequence` represents the
/// latest confirmed sequence on-chain.  `pending_swaps` holds swaps
/// that have been assigned a sequence but have not yet been
/// successfully sent.

pub struct SequenceTracker {
    db: Db,
    current_sequence: u64,
    pending_swaps: VecDeque<(u64, SwapRequest)>,
}

impl SequenceTracker {
    pub fn new(db_path: &str) -> Result<Self> {
        let db = sled::open(db_path)?;

        // Load last known sequence from database
        let current_sequence = if let Some(seq_bytes) = db.get("current_sequence")? {
            u64::from_le_bytes(seq_bytes.as_ref().try_into()?)
        } else {
            0
        };

        Ok(Self {
            db,
            current_sequence,
            pending_swaps: VecDeque::new(),
        })
    }

    pub fn get_current_sequence(&self) -> Result<u64> {
        Ok(self.current_sequence)
    }

    /// Get the next sequence to be used.  This takes into account any
    /// pending swaps that have already reserved a sequence but haven't
    /// been processed yet.
    pub fn get_next_sequence(&self) -> u64 {
        match self.pending_swaps.back() {
            Some((seq, _)) => seq + 1,
            None => self.current_sequence + 1,
        }
    }

    pub fn get_pending_count(&self) -> usize {
        self.pending_swaps.len()
    }

    pub fn update_on_chain_sequence(&mut self, seq: u64) -> Result<()> {
        self.current_sequence = seq;

        // Persist to database
        self.db.insert("current_sequence", &seq.to_le_bytes())?;

        Ok(())
    }

    pub fn add_pending_swap(&mut self, seq: u64, request: SwapRequest) -> Result<()> {
        self.pending_swaps.push_back((seq, request));
        Ok(())
    }

    /// Remove a pending swap that has been successfully processed.
    pub fn remove_pending_swap(&mut self, seq: u64) {
        if let Some(pos) = self.pending_swaps.iter().position(|(s, _)| *s == seq) {
            self.pending_swaps.remove(pos);
        }
    }

    /// Resequence the queue after a failure.  `failed_seq` is the sequence that
    /// failed. If `failed_request` is `Some`, the swap will be retried; otherwise
    /// it will be dropped. All subsequent pending swaps are requeued with newly
    /// assigned sequence numbers.
    pub fn requeue_after_failure(
        &mut self,
        failed_seq: u64,
        failed_request: Option<SwapRequest>,
    ) -> Result<()> {
        // Reset the current sequence to the last successfully processed value.
        if failed_seq > 0 {
            self.current_sequence = failed_seq - 1;
        } else {
            self.current_sequence = 0;
        }

        // Collect swaps to requeue. Start with any provided failed request.
        let mut to_requeue: Vec<SwapRequest> = Vec::new();
        if let Some(req) = failed_request {
            to_requeue.push(req);
        }

        while let Some((seq, req)) = self.pending_swaps.pop_front() {
            if seq == failed_seq {
                // Drop the failed request if it was already queued and no
                // explicit retry request was supplied.
                if to_requeue.is_empty() {
                    // no retry; skip
                } else {
                    // retry already included from parameter, skip original
                }
            } else if seq > failed_seq {
                to_requeue.push(req);
            } else {
                // Swaps with lower sequence remain in the queue.
                self.pending_swaps.push_back((seq, req));
            }
        }

        // Assign new sequences sequentially and push back onto the queue.
        for req in to_requeue.into_iter() {
            let seq = self.get_next_sequence();
            self.pending_swaps.push_back((seq, req));
        }

        Ok(())
    }

    pub fn get_ready_swaps(&mut self) -> Vec<(u64, SwapRequest)> {
        let mut ready = Vec::new();

        while let Some((seq, _)) = self.pending_swaps.front() {
            if *seq == self.current_sequence + 1 {
                if let Some(swap) = self.pending_swaps.pop_front() {
                    ready.push(swap);
                }
            } else {
                break;
            }
        }

        ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn dummy_request() -> SwapRequest {
        SwapRequest {
            user_pubkey: String::new(),
            pool_id: String::new(),
            amount_in: 1,
            minimum_amount_out: 1,
            token_a_account: String::new(),
            token_b_account: String::new(),
            is_a_to_b: true,
        }
    }

    fn tracker() -> SequenceTracker {
        let dir = TempDir::new().unwrap();
        SequenceTracker::new(dir.path().to_str().unwrap()).unwrap()
    }

    #[test]
    fn simulation_failure_removes_and_resequences() {
        let mut tracker = tracker();
        let req1 = dummy_request();
        let seq1 = tracker.get_next_sequence();
        tracker.add_pending_swap(seq1, req1).unwrap();
        let req2 = dummy_request();
        let seq2 = tracker.get_next_sequence();
        tracker.add_pending_swap(seq2, req2.clone()).unwrap();

        // Simulate failure for first swap; drop it and resequence others
        tracker.requeue_after_failure(seq1, None).unwrap();

        let ready = tracker.get_ready_swaps();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].0, 1); // second swap reassigned to sequence 1
    }

    #[test]
    fn send_failure_resequences_queue() {
        let mut tracker = tracker();
        let req1 = dummy_request();
        let req2 = dummy_request();
        let seq1 = tracker.get_next_sequence();
        tracker.add_pending_swap(seq1, req1.clone()).unwrap();
        let seq2 = tracker.get_next_sequence();
        tracker.add_pending_swap(seq2, req2.clone()).unwrap();

        // Pop the first swap as if it's being processed
        let ready = tracker.get_ready_swaps();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].0, 1);

        // Send failure for seq1; requeue it along with subsequent swaps
        tracker.requeue_after_failure(seq1, Some(req1)).unwrap();

        let ready_after = tracker.get_ready_swaps();
        assert_eq!(ready_after.len(), 1);
        assert_eq!(ready_after[0].0, 1); // first swap retried

        tracker.update_on_chain_sequence(1).unwrap();
        let ready2 = tracker.get_ready_swaps();
        assert_eq!(ready2.len(), 1);
        assert_eq!(ready2[0].0, 2); // second swap reassigned
    }
}
