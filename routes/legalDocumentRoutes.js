import express from 'express';
import { getLegalDocument, upsertLegalDocument, listLegalDocuments, deleteLegalDocument } from '../controllers/legalDocumentController.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', adminAuth, listLegalDocuments); // list all (admin)
router.get('/:slug', getLegalDocument); // public fetch
router.put('/:slug', adminAuth, upsertLegalDocument); // create/update
router.delete('/:slug', adminAuth, deleteLegalDocument); // delete/reset

export default router;
