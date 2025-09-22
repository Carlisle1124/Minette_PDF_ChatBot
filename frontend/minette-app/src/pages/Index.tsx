import { useState } from "react";
import { Chat } from "@/components/rag/Chat";
import turtle from "@/assets/minette-turtle.png";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  NotificationsButton,
  type Notification,
} from "@/components/ui/notifications";
import { v4 as uuidv4 } from "uuid";
import { Link } from "react-router-dom";

const Index = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Add notification handler
  const addNotification = (
    title: string,
    message: string,
    type: "info" | "success" | "warning" | "error" = "info"
  ) => {
    const newNotification: Notification = {
      id: uuidv4(),
      title,
      message,
      timestamp: new Date(),
      read: false,
      type,
    };
    setNotifications((prev) => [newNotification, ...prev]);
  };

  // Mark notification as read
  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  };

  // Clear all notifications
  const clearAllNotifications = () => {
    setNotifications([]);
  };

  // Clear individual notification
  const clearIndividualNotification = (id: string) => {
    setNotifications((prev) =>
      prev.filter((notification) => notification.id !== id)
    );
  };

  const handleDocumentDeleted = () => {
    // Additional handling if needed when documents are deleted
  };
  return (
    <main className="container py-10 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img
            src={turtle}
            alt="Minette turtle logo"
            className="h-10 w-10"
            loading="lazy"
          />
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">Minette</h1>
            <p className="text-muted-foreground">
              Local-first RAG with Ollama (Llama 3) + semantic search.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/debug/documents"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Debug
          </Link>
          <NotificationsButton
            notifications={notifications}
            onMarkAsRead={markAsRead}
            onClearAll={clearAllNotifications}
            onClearIndividual={clearIndividualNotification}
          />
          <ThemeToggle />
        </div>
      </header>
      <Chat
        onNotification={addNotification}
        onDocumentDeleted={handleDocumentDeleted}
      />
    </main>
  );
};

export default Index;
