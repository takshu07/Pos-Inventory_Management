import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/httpStatus";
import { configurationService } from "../services/configuration.service";
import { configurationUpdateSchema } from "../validation/configuration.validation";
import { asyncHandler } from "../utils/asyncHandler";

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const config = configurationService.getFullConfiguration();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Configuration retrieved successfully.",
    data: config,
  });
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const data = configurationUpdateSchema.parse({ body: req.body }).body;
  const result = await configurationService.updateConfiguration(data, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Configuration updated successfully. Engine cache reloaded.",
    data: result,
  });
});
