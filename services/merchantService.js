const merchantAuthService = require('./merchant/merchantAuthService');
const merchantTransferService = require('./merchant/merchantTransferService');
const merchantHistoryService = require('./merchant/merchantHistoryService');

/**
 * Merchant Service Facade
 * Delegates tasks to modular sub-services for high maintainability,
 * while preserving 100% backward compatibility for all controllers and routes.
 */
const merchantService = {
    // Auth & Role Management
    getAllMerchants: (args) => merchantAuthService.getAllMerchants(args),
    addOrUpdateMerchant: (args) => merchantAuthService.addOrUpdateMerchant(args),
    getMyMerchantStatus: (userId) => merchantAuthService.getMyMerchantStatus(userId),
    removeMerchant: (args) => merchantAuthService.removeMerchant(args),
    getMerchantDetails: (userId) => merchantAuthService.getMerchantDetails(userId),

    // Stock & Coin Transfer Engine
    allocateStock: (args) => merchantTransferService.allocateStock(args),
    rechargeUser: (args) => merchantTransferService.rechargeUser(args),

    // History & Ledger Audit
    getMerchantHistory: (args) => merchantHistoryService.getMerchantHistory(args),
    getAllTransactions: (args) => merchantHistoryService.getAllTransactions(args)
};

module.exports = merchantService;
