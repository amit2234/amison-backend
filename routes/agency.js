const express = require('express');
const router = express.Router();
const AgencyController = require('../controllers/agencyController');
const NewopController = require('../controllers/newopController');

// All endpoints require admin privilege
router.get('/', NewopController.requireNewopAdmin, AgencyController.getAllAgencies);
router.post('/create', NewopController.requireNewopAdmin, AgencyController.createAgency);
router.post('/update', NewopController.requireNewopAdmin, AgencyController.updateAgency);
router.post('/block', NewopController.requireNewopAdmin, AgencyController.blockAgency);
router.get('/:id/hosts', NewopController.requireNewopAdmin, AgencyController.getAgencyHosts);
router.post('/hosts/add', NewopController.requireNewopAdmin, AgencyController.addHost);
router.post('/hosts/remove', NewopController.requireNewopAdmin, AgencyController.removeHost);

module.exports = router;
