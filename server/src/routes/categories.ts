import { Router } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Category, toPublicCategory } from '../models/Category.js';
import { createCategorySchema, updateCategorySchema } from '../validators/categories.js';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await Category.find().sort({ parentId: 1, name: 1 });
    res.json({ categories: categories.map(toPublicCategory) });
  }),
);

categoriesRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    if (req.body.parentId) {
      const parent = await Category.findById(req.body.parentId);
      if (!parent) throw new AppError(400, 'Unknown parent category');
      if (parent.parentId) throw new AppError(400, 'Categories go at most two levels deep');
    }
    const category = await Category.create({ name: req.body.name, parentId: req.body.parentId ?? null });
    res.status(201).json({ category: toPublicCategory(category) });
  }),
);

categoriesRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await Category.findByIdAndUpdate(req.params.id, { $set: { name: req.body.name } }, { new: true });
    if (!category) throw new AppError(404, 'Category not found');
    res.json({ category: toPublicCategory(category) });
  }),
);

categoriesRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw new AppError(404, 'Category not found');
    const childCount = await Category.countDocuments({ parentId: category.id });
    if (childCount > 0) throw new AppError(400, 'Delete or move its subcategories first');
    // Guard against resources referencing this category. The Resource model lands in the
    // next task; querying the raw collection keeps this file import-cycle-free and makes
    // the guard activate automatically once resources exist.
    const resourceCount = await mongoose.connection.db!
      .collection('resources')
      .countDocuments({ $or: [{ categoryId: category._id }, { subcategoryId: category._id }] });
    if (resourceCount > 0) throw new AppError(400, 'Move or delete the resources in this category first');
    await category.deleteOne();
    res.json({ ok: true });
  }),
);
