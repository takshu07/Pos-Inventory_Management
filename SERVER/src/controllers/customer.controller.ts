import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { customerService } from "../services/customer.service";
import { customerValidation } from "../validation/customer.validation";

export const customerController = {
  /**
   * GET /api/v1/customers
   */
  getCustomers: asyncHandler(async (req: Request, res: Response) => {
    const params = customerValidation.query.parse(req.query);
    const result = await customerService.getCustomers(params);
    res.status(200).json({
      success: true,
      message: "Customers retrieved successfully.",
      data: result,
    });
  }),

  /**
   * GET /api/v1/customers/table  (owner/manager only)
   * Server-side paginated customer table with sale aggregates.
   */
  getCustomerTable: asyncHandler(async (req: Request, res: Response) => {
    const query = customerValidation.tableQuery.parse(req.query);
    const result = await customerService.getCustomerTable(query);
    res.status(200).json({
      success: true,
      message: "Customer table retrieved successfully.",
      data: result,
    });
  }),

  /**
   * GET /api/v1/customers/analytics  (owner/manager only)
   * Aggregate metrics for the owner dashboard cards.
   */
  getCustomerAnalytics: asyncHandler(async (_req: Request, res: Response) => {
    const result = await customerService.getCustomerAnalytics();
    res.status(200).json({
      success: true,
      message: "Customer analytics retrieved successfully.",
      data: result,
    });
  }),

  /**
   * GET /api/v1/customers/walk-in
   */
  getWalkInCustomer: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.getWalkInCustomer();
    res.status(200).json({
      success: true,
      message: "Walk-In customer retrieved successfully.",
      data: customer,
    });
  }),

  /**
   * GET /api/v1/customers/:id
   */
  getCustomerById: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.getCustomerById(req.params["id"] as string);
    res.status(200).json({
      success: true,
      message: "Customer retrieved successfully.",
      data: customer,
    });
  }),

  /**
   * GET /api/v1/customers/phone/:phone
   */
  getCustomerByPhone: asyncHandler(async (req: Request, res: Response) => {
    const customer = await customerService.getCustomerByPhone(req.params["phone"] as string);
    res.status(200).json({
      success: true,
      message: customer ? "Customer found." : "Customer not found.",
      data: customer,
    });
  }),

  /**
   * POST /api/v1/customers
   */
  createCustomer: asyncHandler(async (req: Request, res: Response) => {
    const data = customerValidation.create.parse(req.body);
    const newCustomer = await customerService.createCustomer(data, req.user!.id);
    res.status(201).json({
      success: true,
      message: "Customer created successfully.",
      data: newCustomer,
    });
  }),

  /**
   * PATCH /api/v1/customers/:id
   */
  updateCustomer: asyncHandler(async (req: Request, res: Response) => {
    const data = customerValidation.update.parse(req.body);
    const updatedCustomer = await customerService.updateCustomer(req.params["id"] as string, data, req.user!.id);
    res.status(200).json({
      success: true,
      message: "Customer updated successfully.",
      data: updatedCustomer,
    });
  }),

  /**
   * GET /api/v1/customers/:id/purchases
   */
  getCustomerPurchases: asyncHandler(async (req: Request, res: Response) => {
    const params = customerValidation.query.parse(req.query);
    const result = await customerService.getCustomerPurchaseHistory(req.params["id"] as string, params);
    res.status(200).json({
      success: true,
      message: "Customer purchases retrieved successfully.",
      data: result,
    });
  }),

  /**
   * GET /api/v1/customers/:id/exchange-eligibility
   */
  getExchangeEligibility: asyncHandler(async (req: Request, res: Response) => {
    const limitRaw = req.query["limit"];
    const limit = limitRaw ? Math.min(Math.max(parseInt(String(limitRaw), 10) || 10, 1), 50) : 10;
    const result = await customerService.getExchangeEligibility(req.params["id"] as string, limit);
    res.status(200).json({
      success: true,
      message: "Exchange eligibility retrieved successfully.",
      data: result,
    });
  }),
};
