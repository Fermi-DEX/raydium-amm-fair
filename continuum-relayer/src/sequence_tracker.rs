use crate::{errors::RelayerError, SwapRequest};
use anyhow::Result;
use sled::Db;
use std::collections::VecDeque;

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
    
    pub fn get_next_sequence(&self) -> u64 {
        self.current_sequence + 1
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