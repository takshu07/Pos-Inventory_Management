import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import os from "os";

export const getLiveness = (_req: Request, res: Response) => {
  // Liveness simply indicates the Node.js process is running and hasn't deadlocked.
  return res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
};

export const getReadiness = async (_req: Request, res: Response) => {
  // Readiness indicates if the app can accept traffic (Database is reachable)
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: "ready", database: "connected" });
  } catch (error) {
    return res.status(503).json({ status: "not_ready", database: "disconnected" });
  }
};

export const getDetailedHealth = async (_req: Request, res: Response) => {
  // Full health dump for internal admin dashboards
  const health = {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    system: {
      memory: {
        free: os.freemem(),
        total: os.totalmem(),
        processRss: process.memoryUsage().rss
      },
      cpu: os.loadavg(),
    },
    database: "unknown"
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = "connected";
    return res.status(200).json(health);
  } catch (error) {
    health.status = "degraded";
    health.database = "disconnected";
    return res.status(503).json(health); // 503 Service Unavailable
  }
};
