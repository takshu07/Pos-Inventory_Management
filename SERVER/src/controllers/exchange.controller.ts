import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { exchangeService } from "../services/exchange.service";
import { exchangeValidation } from "../validation/exchange.validation";

export const exchangeController = {
  /**
   * GET /api/v1/exchanges
   */
  getExchanges: asyncHandler(async (req: Request, res: Response) => {
    const params = exchangeValidation.query.parse(req.query);
    const result = await exchangeService.getExchanges(params);
    res.status(200).json({
      success: true,
      message: "Exchanges retrieved successfully",
      data: result,
    });
  }),

  /**
   * GET /api/v1/exchanges/:id
   */
  getExchangeById: asyncHandler(async (req: Request, res: Response) => {
    const exchange = await exchangeService.getExchangeById(req.params["id"] as string);
    res.status(200).json({
      success: true,
      message: "Exchange retrieved successfully",
      data: exchange,
    });
  }),

  /**
   * POST /api/v1/exchanges
   */
  createExchange: asyncHandler(async (req: Request, res: Response) => {
    const data = exchangeValidation.create.parse(req.body);
    const exchange = await exchangeService.processExchange(data, req.user!.id);
    
    res.status(201).json({
      success: true,
      message: "Exchange processed successfully",
      data: exchange,
    });
  }),
};
