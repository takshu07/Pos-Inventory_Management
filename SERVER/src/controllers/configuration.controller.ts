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
  // `expectedVersion` is optimistic-concurrency metadata, not configuration, so
  // it is pulled off before the body is validated — the update schema is strict
  // about which keys it accepts and would otherwise have to model a field that
  // is never persisted. Optional: omitting it keeps last-write-wins.
  const { expectedVersion, ...body } = req.body ?? {};
  const data = configurationUpdateSchema.parse({ body }).body;

  const result = await configurationService.updateConfiguration(
    data,
    req.user.id,
    typeof expectedVersion === "number" ? expectedVersion : undefined
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Configuration updated successfully. Engine cache reloaded.",
    data: result,
  });
});
