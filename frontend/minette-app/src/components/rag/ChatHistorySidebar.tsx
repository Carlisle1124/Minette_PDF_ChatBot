// ChatHistorySidebar.tsx - Sidebar component for managing chat histories
import React, { useState, useEffect } from "react";
import { MessageSquare, Trash2, Edit2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatStorageManager, ChatHistory } from "@/lib/chatStorage";
import { toast } from "sonner";

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChatSelect: (chat: ChatHistory) => void;
  currentChatId?: string;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  isOpen,
  onOpenChange,
  onChatSelect,
  currentChatId,
}) => {
  const [chats, setChats] = useState<ChatHistory[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Load chats when component mounts or sidebar opens
  useEffect(() => {
    if (isOpen) {
      loadChats();
    }
  }, [isOpen]);

  const loadChats = () => {
    const chatHistories = ChatStorageManager.getAllChats();
    setChats(chatHistories);
  };

  const handleDeleteClick = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChatToDelete(chatId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (chatToDelete) {
      ChatStorageManager.deleteChat(chatToDelete);
      loadChats();
      toast.success("Chat deleted successfully");
      setDeleteDialogOpen(false);
      setChatToDelete(null);
    }
  };

  const handleEditClick = (chat: ChatHistory, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  const handleRename = (chatId: string) => {
    if (editingTitle.trim()) {
      const success = ChatStorageManager.renameChat(
        chatId,
        editingTitle.trim()
      );
      if (success) {
        loadChats();
        toast.success("Chat renamed successfully");
      } else {
        toast.error("Failed to rename chat");
      }
    }
    setEditingChatId(null);
    setEditingTitle("");
  };

  const handleChatClick = (chat: ChatHistory) => {
    onChatSelect(chat);
    onOpenChange(false);
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffInDays === 0) {
      return "Today";
    } else if (diffInDays === 1) {
      return "Yesterday";
    } else if (diffInDays < 7) {
      return `${diffInDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getPreviewText = (chat: ChatHistory) => {
    if (chat.messages.length === 0) return "No messages yet";

    const firstMessage = chat.messages.find((msg) => msg.role === "user");
    if (firstMessage) {
      return firstMessage.content.length > 60
        ? firstMessage.content.substring(0, 57) + "..."
        : firstMessage.content;
    }

    return "No messages yet";
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-80">
          <SheetHeader>
            <SheetTitle>Chat History</SheetTitle>
            <SheetDescription>
              View and manage your previous conversations
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-120px)] mt-4">
            {chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No chat history yet</p>
                <p className="text-sm text-muted-foreground/70">
                  Start a conversation to see it here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {chats.map((chat) => (
                  <div
                    key={chat.id}
                    className={`group border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                      currentChatId === chat.id
                        ? "bg-accent border-accent-foreground/20"
                        : ""
                    }`}
                    onClick={() => handleChatClick(chat)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {editingChatId === chat.id ? (
                          <Input
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => handleRename(chat.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleRename(chat.id);
                              } else if (e.key === "Escape") {
                                setEditingChatId(null);
                                setEditingTitle("");
                              }
                            }}
                            className="h-6 text-sm font-medium"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h4 className="font-medium text-sm truncate">
                            {chat.title}
                          </h4>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {getPreviewText(chat)}
                        </p>
                        <div className="flex items-center gap-1 mt-2">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatDate(chat.updatedAt)}
                          </span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {chat.messages.length} messages
                          </span>
                        </div>
                        {chat.documentContext.filenames.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            📄 {chat.documentContext.filenames.length}{" "}
                            document(s)
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => handleEditClick(chat, e)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteClick(chat.id, e)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this chat? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
