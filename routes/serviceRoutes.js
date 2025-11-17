import express from 'express';
import { adminAuth, adminOrCategoryManager, enforceCategoryScopeByBodyIds } from '../middleware/auth.js';
import { listServices, getServiceById, createService, updateService, deleteService, toggleService, reorderServices, listAssignments, createAssignment, updateAssignment, deleteAssignment } from '../controllers/serviceController.js';

const router = express.Router();

// Public list (can be adjusted later based on requirements)
router.get('/', listServices);
router.get('/:id', adminAuth, getServiceById);

// Admin-only mutations
router.post('/', adminAuth, createService);
router.put('/:id', adminAuth, updateService);
router.delete('/:id', adminAuth, deleteService);
router.post('/:id/toggle', adminAuth, toggleService);
router.post('/reorder', adminAuth, reorderServices);

// Category-service assignments
router.get('/assignments', adminOrCategoryManager, listAssignments);
router.post(
	'/assignments',
	adminOrCategoryManager,
	enforceCategoryScopeByBodyIds((req) => {
		const id = req.body?.category;
		return id ? [String(id)] : [];
	}),
	createAssignment
);
router.put('/assignments/:id', adminOrCategoryManager, updateAssignment);
router.delete('/assignments/:id', adminOrCategoryManager, deleteAssignment);

export default router;
