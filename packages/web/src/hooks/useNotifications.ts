import { useEffect, useRef } from "react";

/** Payload shape for notification.escalated domain events. */
interface EscalationPayload {
  escalationId: string;
  taskId: string;
  title: string;
  message: string;
  source: string;
  urgency: string;
  taskUrl: string;
}

/** Domain event shape matching GrackleEvent from the event bus. */
interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Hook that requests browser notification permission and shows
 * native notifications when escalation events arrive.
 */
export function useNotifications(): {
  handleEvent: (event: DomainEvent) => boolean;
} {
  const permissionRef = useRef<NotificationPermission>("default");

  // Request permission on mount
  useEffect(() => {
    if (typeof Notification === "undefined") {
      return;
    }
    permissionRef.current = Notification.permission;
    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        permissionRef.current = perm;
      }).catch(() => {});
    }
  }, []);

  function handleEvent(event: DomainEvent): boolean {
    if (event.type !== "notification.escalated") {
      return false;
    }

    if (typeof Notification === "undefined" || permissionRef.current !== "granted") {
      return true; // Consumed the event but can't show notification
    }

    const payload = event.payload as unknown as EscalationPayload;
    const notification = new Notification(payload.title || "Agent needs input", {
      body: payload.message || "An agent is waiting for your input.",
      tag: payload.escalationId, // Prevents duplicate notifications for same escalation
      icon: "/grackle-icon.png",
    });

    notification.onclick = () => {
      window.focus();
      if (payload.taskUrl) {
        window.location.href = payload.taskUrl;
      }
      notification.close();
    };

    return true;
  }

  return { handleEvent };
}
