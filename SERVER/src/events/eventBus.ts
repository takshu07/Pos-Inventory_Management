import { randomUUID } from "crypto";
import { logger } from "../config/logger";
import { auditRepository } from "../repositories/audit.repository";
import { ActionType, ActionModule } from "../../generated/prisma";
import type { BaseDomainEvent, EventTopic } from "./domainEvents";

type EventHandler<T extends BaseDomainEvent = any> = (event: T) => Promise<void> | void;

interface Subscriber {
  id: string;
  name: string;
  handler: EventHandler;
  priority: number;
}

export class EventBus {
  private static subscribers: Map<EventTopic, Subscriber[]> = new Map();

  /**
   * Subscribes a handler to a specific event topic.
   */
  static subscribe<T extends BaseDomainEvent>(
    topic: EventTopic,
    subscriberName: string,
    handler: EventHandler<T>,
    priority = 0
  ): string {
    const subscriberId = randomUUID();
    const subs = this.subscribers.get(topic) || [];
    
    subs.push({
      id: subscriberId,
      name: subscriberName,
      handler: handler as EventHandler,
      priority
    });
    
    // Sort descending by priority (higher priority runs first)
    subs.sort((a, b) => b.priority - a.priority);
    this.subscribers.set(topic, subs);
    
    logger.info(`[EventBus] Subscriber '${subscriberName}' registered for topic '${topic}'`);
    return subscriberId;
  }

  /**
   * Publishes an event asynchronously to all registered subscribers.
   */
  static async publish<T extends BaseDomainEvent>(event: T): Promise<void> {
    const subs = this.subscribers.get(event.topic) || [];
    
    // 1. Audit Log the Publish (Fire and forget)
    auditRepository.create({
      action: ActionType.CREATE,
      module: ActionModule.SALE, // We could map topics to modules, defaulting for now
      performedBy: event.actorId || "SYSTEM",
      tableName: event.aggregateType,
      recordId: event.aggregateId,
      newData: { eventId: event.eventId, topic: event.topic, payload: event.payload }
    }).catch(e => logger.error({ err: e }, "[EventBus] Audit failure"));

    if (subs.length === 0) {
      logger.debug(`[EventBus] No subscribers for event ${event.topic}`);
      return;
    }

    logger.info(`[EventBus] Publishing event ${event.topic} (ID: ${event.eventId}) to ${subs.length} subscribers`);

    // 2. Dispatch to subscribers asynchronously
    // In a distributed setup, this pushes to RabbitMQ/Kafka.
    // For Node.js in-process, we dispatch via Promise.allSettled to ensure isolation.
    setImmediate(() => {
      Promise.allSettled(
        subs.map(async (sub) => {
          try {
            await sub.handler(event);
            logger.debug(`[EventBus] Subscriber ${sub.name} processed ${event.topic} successfully`);
          } catch (error) {
            // Failure in one subscriber MUST NOT crash the bus or other subscribers.
            logger.error({ err: error, subscriber: sub.name, event: event.eventId }, `[EventBus] Subscriber ${sub.name} failed to process ${event.topic}`);
            // Future: Push to Dead Letter Queue (DLQ) here
          }
        })
      );
    });
  }

  /**
   * Helper to create standard events easily
   */
  static createEvent<T>(
    topic: EventTopic,
    aggregateId: string,
    aggregateType: string,
    payload: T,
    actorId?: string,
    sourceModule = "Core"
  ): BaseDomainEvent<T> {
    return {
      eventId: randomUUID(),
      topic,
      timestamp: new Date(),
      aggregateId,
      aggregateType,
      payload,
      actorId,
      sourceModule
    };
  }
}
