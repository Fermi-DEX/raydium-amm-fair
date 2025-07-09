"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountMeta = accountMeta;
exports.sleep = sleep;
function accountMeta(options) {
    return {
        pubkey: options.pubkey,
        isSigner: options.isSigner || false,
        isWritable: options.isMut || options.isWritable || false
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=helpers.js.map