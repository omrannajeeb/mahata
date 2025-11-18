import express from 'express';
import { adminAuth, adminOrCategoryManager, enforceCategoryScopeByBodyIds } from '../middleware/auth.js';
import { listServices, getServiceById, createService, updateService, deleteService, toggleService, reorderServices, listAssignments, createAssignment, updateAssignment, deleteAssignment } from '../controllers/serviceController.js';

const router = express.Router();

// Public list (can be adjusted later based on requirements)
router.get('/', listServices);

// Category-service assignments must be declared BEFORE '/:id' to avoid route conflicts
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

router.get('/:id', adminAuth, getServiceById);

// Admin-only mutations
router.post('/', adminAuth, createService);
router.put('/:id', adminAuth, updateService);
router.delete('/:id', adminAuth, deleteService);
router.post('/:id/toggle', adminAuth, toggleService);
router.post('/reorder', adminAuth, reorderServices);

// (moved assignments routes above)

export default router;
