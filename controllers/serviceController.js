import asyncHandler from 'express-async-handler';
import Service from '../models/Service.js';
import CategoryServiceAssignment from '../models/CategoryServiceAssignment.js';

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const listServices = asyncHandler(async (req, res) => {
  const items = await Service.find().sort({ order: 1, createdAt: 1 });
  res.json(items);
});

export const getServiceById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await Service.findById(id);
  if (!item) return res.status(404).json({ message: 'Service not found' });
  res.json(item);
});

export const createService = asyncHandler(async (req, res) => {
  const { title, description, feePerUnit = 0, isActive = true, imageUrl, slug, order = 0, category } = req.body || {};
  const normalizedSlug = slug ? String(slug).trim().toLowerCase() : (title ? slugify(title) : undefined);
  const item = await Service.create({ title, description, feePerUnit, isActive, imageUrl, slug: normalizedSlug, order, category });
  res.status(201).json(item);
});

export const updateService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await Service.findById(id);
  if (!item) return res.status(404).json({ message: 'Service not found' });
  const updatable = ['title', 'description', 'feePerUnit', 'isActive', 'imageUrl', 'slug', 'order', 'category'];
  updatable.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) {
      const val = req.body[k];
      if (k === 'slug' && typeof val === 'string') item[k] = val.trim().toLowerCase();
      else item[k] = val;
    }
  });
  if (!('slug' in (req.body || {})) && typeof req.body?.title === 'string' && !item.slug) {
    item.slug = slugify(req.body.title);
  }
  await item.save();
  res.json(item);
});

export const deleteService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await Service.findById(id);
  if (!item) return res.status(404).json({ message: 'Service not found' });
  await item.deleteOne();
  res.json({ success: true });
});

export const toggleService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { active } = req.body || {};
  const item = await Service.findById(id);
  if (!item) return res.status(404).json({ message: 'Service not found' });
  item.isActive = !!active;
  await item.save();
  res.json(item);
});

export const reorderServices = asyncHandler(async (req, res) => {
  const { order } = req.body; // [{id, order}]
  if (!Array.isArray(order)) return res.status(400).json({ message: 'Invalid order payload' });
  const ops = order.map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { order: o.order } } } }));
  if (ops.length) await Service.bulkWrite(ops);
  const items = await Service.find().sort({ order: 1, createdAt: 1 });
  res.json(items);
});

// ----- Category-Service Assignments -----
export const listAssignments = asyncHandler(async (req, res) => {
  const { category } = req.query || {};
  const query = category ? { category } : {};
  const rows = await CategoryServiceAssignment.find(query).lean();
  res.json(rows);
});

export const createAssignment = asyncHandler(async (req, res) => {
  const { category, service, feePerUnit, isActive = true } = req.body || {};
  if (!category || !service) return res.status(400).json({ message: 'category and service are required' });
  const doc = await CategoryServiceAssignment.findOneAndUpdate(
    { category, service },
    { $set: { feePerUnit: (feePerUnit === '' || feePerUnit === null || typeof feePerUnit === 'undefined') ? undefined : Number(feePerUnit), isActive: !!isActive } },
    { upsert: true, new: true }
  );
  res.status(201).json(doc);
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { feePerUnit, isActive } = req.body || {};
  const doc = await CategoryServiceAssignment.findById(id);
  if (!doc) return res.status(404).json({ message: 'Assignment not found' });
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'feePerUnit')) {
    doc.feePerUnit = (feePerUnit === '' || feePerUnit === null || typeof feePerUnit === 'undefined') ? undefined : Number(feePerUnit);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isActive')) doc.isActive = !!isActive;
  await doc.save();
  res.json(doc);
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await CategoryServiceAssignment.findById(id);
  if (!doc) return res.status(404).json({ message: 'Assignment not found' });
  await doc.deleteOne();
  res.json({ success: true });
});
