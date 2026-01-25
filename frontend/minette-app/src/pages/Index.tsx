import { useState, useEffect } from "react";
import { Chat } from "@/components/rag/Chat";
import { SettingsPanel } from "@/components/ui/settings-panel";
import {
  NotificationsButton,
  type Notification,
} from "@/components/ui/notifications";
import { v4 as uuidv4 } from "uuid";
import { Link } from "react-router-dom";

// Animated floating logo component with interactive effects
const FloatingLogo = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [direction, setDirection] = useState({ dx: 1, dy: 1 });
  const [isHovered, setIsHovered] = useState(false);
  const [clickEffect, setClickEffect] = useState<"none" | "glow" | "shake">(
    "none",
  );

  useEffect(() => {
    const speed = 0.5;

    const animate = () => {
      setPosition((prev) => {
        let newX = prev.x + direction.dx * speed;
        let newY = prev.y + direction.dy * speed;
        let newDx = direction.dx;
        let newDy = direction.dy;

        // Bounce off boundaries (small movement range)
        if (newX > 15 || newX < -15) {
          newDx = -newDx;
          newX = Math.max(-15, Math.min(15, newX));
        }
        if (newY > 10 || newY < -10) {
          newDy = -newDy;
          newY = Math.max(-10, Math.min(10, newY));
        }

        if (newDx !== direction.dx || newDy !== direction.dy) {
          setDirection({ dx: newDx, dy: newDy });
        }

        return { x: newX, y: newY };
      });
    };

    const interval = setInterval(animate, 16);
    return () => clearInterval(interval);
  }, [direction]);

  const handleClick = () => {
    // Random effect: glow or shake
    const effect = Math.random() > 0.5 ? "glow" : "shake";
    setClickEffect(effect);

    // Reset effect after animation
    setTimeout(() => setClickEffect("none"), 600);
  };

  const getClickEffectClass = () => {
    if (clickEffect === "glow") {
      return "animate-pulse brightness-150 dark:brightness-200 drop-shadow-[0_0_30px_rgba(168,85,247,0.9)]";
    }
    if (clickEffect === "shake") {
      return "animate-[shake_0.5s_ease-in-out]";
    }
    return "";
  };

  return (
    <img
      src="/minette.png"
      alt="Minette logo"
      className={`h-36 w-36 sm:h-40 sm:w-40 transition-all duration-300 cursor-pointer drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)] dark:drop-shadow-none brightness-0 dark:brightness-100 ${
        isHovered
          ? "scale-[2] z-50 drop-shadow-[0_8px_30px_rgba(168,85,247,0.8)]"
          : ""
      } ${getClickEffectClass()}`}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)${
          isHovered ? " scale(2)" : ""
        }`,
      }}
      loading="lazy"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    />
  );
};

const Index = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Add notification handler
  const addNotification = (
    title: string,
    message: string,
    type: "info" | "success" | "warning" | "error" = "info",
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
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
  };

  // Clear all notifications
  const clearAllNotifications = () => {
    setNotifications([]);
  };

  // Clear individual notification
  const clearIndividualNotification = (id: string) => {
    setNotifications((prev) =>
      prev.filter((notification) => notification.id !== id),
    );
  };

  const handleDocumentDeleted = () => {
    // Additional handling if needed when documents are deleted
  };
  return (
    <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-full lg:max-w-7xl xl:max-w-[1400px]">
      <header className="flex items-center justify-between gap-4">
        <div className="w-24 sm:w-32"></div>
        <div className="flex items-center gap-3 bg-purple-100/80 dark:bg-transparent px-4 py-2 rounded-xl shadow-sm dark:shadow-none">
          <FloatingLogo />
          <h1 className="text-2xl sm:text-3xl font-bold text-purple-900 dark:text-foreground">
            Minette
          </h1>
        </div>
        <div className="flex items-center gap-2 w-24 sm:w-32 justify-end">
          <Link
            to="/debug/documents"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Debug
          </Link>
          <SettingsPanel />
          <NotificationsButton
            notifications={notifications}
            onMarkAsRead={markAsRead}
            onClearAll={clearAllNotifications}
            onClearIndividual={clearIndividualNotification}
          />
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
