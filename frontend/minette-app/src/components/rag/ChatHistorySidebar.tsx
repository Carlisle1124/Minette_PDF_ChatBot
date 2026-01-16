// ChatHistorySidebar.tsx - Sidebar component for managing chat histories
import React, { useState, useEffect, useRef } from "react";
import {
  MessageSquare,
  Trash2,
  Edit2,
  Search,
  FileText,
  Loader2,
  Calendar,
  MessageCircle,
  X,
  Check,
  CheckSquare,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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
import { Badge } from "@/components/ui/badge";
import { ChatStorageManager, ChatHistory } from "@/lib/chatStorage";
import { deleteChatFromBackend } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChatSelect: (chat: ChatHistory) => void;
  currentChatId?: string;
  onChatDeleted?: () => void;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  isOpen,
  onOpenChange,
  onChatSelect,
  currentChatId,
  onChatDeleted,
}) => {
  const [chats, setChats] = useState<ChatHistory[]>([]);
  const [filteredChats, setFilteredChats] = useState<ChatHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [chatToDeleteTitle, setChatToDeleteTitle] = useState<string>("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Load chats when component mounts or sidebar opens
  useEffect(() => {
    if (isOpen) {
      loadChats();
    }
  }, [isOpen]);

  // Focus input when editing
  useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChatId]);

  // Filter chats when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredChats(chats);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredChats(
        chats.filter(
          (chat) =>
            chat.title.toLowerCase().includes(query) ||
            chat.messages.some((msg) =>
              msg.content.toLowerCase().includes(query)
            )
        )
      );
    }
  }, [searchQuery, chats]);

  const loadChats = () => {
    const chatHistories = ChatStorageManager.getAllChats();
    setChats(chatHistories);
    setFilteredChats(chatHistories);
  };

  const handleDeleteClick = (
    chatId: string,
    chatTitle: string,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    setChatToDelete(chatId);
    setChatToDeleteTitle(chatTitle);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (chatToDelete) {
      setIsDeleting(true);
      try {
        // Delete from backend first (documents + embeddings)
        try {
          await deleteChatFromBackend(chatToDelete);
          console.log(`Backend data deleted for chat ${chatToDelete}`);
        } catch (backendError) {
          // Log but continue - backend data might not exist
          console.warn(`Backend delete warning: ${backendError}`);
        }

        // Delete from frontend localStorage
        ChatStorageManager.deleteChat(chatToDelete);
        loadChats();
        toast.success("Chat and all associated data deleted");

        // Notify parent if this was the current chat
        if (chatToDelete === currentChatId && onChatDeleted) {
          onChatDeleted();
        }
      } catch (error) {
        console.error("Error deleting chat:", error);
        toast.error("Failed to delete chat completely");
      } finally {
        setIsDeleting(false);
        setDeleteDialogOpen(false);
        setChatToDelete(null);
      }
    }
  };

  const toggleSelectChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedChats((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(chatId)) {
        newSet.delete(chatId);
      } else {
        newSet.add(chatId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedChats.size === filteredChats.length) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(filteredChats.map((c) => c.id)));
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedChats(new Set());
  };

  const confirmBulkDelete = async () => {
    if (selectedChats.size === 0) return;

    setIsDeleting(true);
    const chatIds = Array.from(selectedChats);
    let deletedCount = 0;
    let hasCurrentChat = false;

    try {
      for (const chatId of chatIds) {
        try {
          await deleteChatFromBackend(chatId);
        } catch (backendError) {
          console.warn(`Backend delete warning for ${chatId}:`, backendError);
        }
        ChatStorageManager.deleteChat(chatId);
        deletedCount++;
        if (chatId === currentChatId) {
          hasCurrentChat = true;
        }
      }

      loadChats();
      toast.success(
        `${deletedCount} chat${deletedCount !== 1 ? "s" : ""} deleted`
      );

      if (hasCurrentChat && onChatDeleted) {
        onChatDeleted();
      }
    } catch (error) {
      console.error("Error during bulk delete:", error);
      toast.error("Failed to delete some chats");
    } finally {
      setIsDeleting(false);
      setBulkDeleteDialogOpen(false);
      exitSelectionMode();
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

  const cancelEditing = () => {
    setEditingChatId(null);
    setEditingTitle("");
  };

  const formatFullDate = (date: Date) => {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="w-full sm:w-96 sm:max-w-[400px] p-0 flex flex-col"
        >
          {/* Fixed Header */}
          <div className="p-4 sm:p-6 pb-0 flex-shrink-0">
            <SheetHeader className="space-y-1">
              <SheetTitle className="text-xl sm:text-2xl flex items-center gap-2">
                <MessageSquare className="h-5 w-5 sm:h-6 sm:w-6" />
                Chat History
              </SheetTitle>
              <SheetDescription className="text-sm">
                View and manage your conversations
              </SheetDescription>
            </SheetHeader>

            {/* Search input */}
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 sm:h-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Selection Controls */}
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-xs text-muted-foreground">
                {searchQuery
                  ? `${filteredChats.length} of ${chats.length} chats found`
                  : `${chats.length} conversation${
                      chats.length !== 1 ? "s" : ""
                    }`}
              </span>

              {!selectionMode ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectionMode(true)}
                  disabled={filteredChats.length === 0}
                >
                  Select
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={exitSelectionMode}
                >
                  Cancel
                </Button>
              )}
            </div>

            {/* Selection Mode Actions */}
            {selectionMode && (
              <div className="flex items-center justify-between mt-2 px-1 py-2 bg-muted/50 rounded-lg">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={toggleSelectAll}
                >
                  {selectedChats.size === filteredChats.length &&
                  filteredChats.length > 0 ? (
                    <>
                      <CheckSquare className="h-3.5 w-3.5" /> Deselect All
                    </>
                  ) : (
                    <>
                      <Square className="h-3.5 w-3.5" /> Select All
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                  disabled={selectedChats.size === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete ({selectedChats.size})
                </Button>
              </div>
            )}
          </div>

          {/* Scrollable Chat List */}
          <ScrollArea className="flex-1 mt-3">
            <div className="px-3 sm:px-4 pr-4 sm:pr-5">
              {filteredChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                  <div className="rounded-full bg-muted p-4 mb-4">
                    <MessageSquare className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-foreground mb-1">
                    {searchQuery ? "No matching chats" : "No conversations yet"}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-[200px]">
                    {searchQuery
                      ? "Try a different search term"
                      : "Start a new chat to see it here"}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 pb-4">
                  {filteredChats.map((chat) => (
                    <div
                      key={chat.id}
                      className={cn(
                        "group w-full border rounded-lg p-2 cursor-pointer transition-all duration-300 overflow-hidden",
                        "hover:shadow-[0_0_15px_rgba(var(--primary-rgb,59,130,246),0.3)] hover:border-primary/50",
                        "active:scale-[0.98]",
                        currentChatId === chat.id
                          ? "bg-accent border-primary/30 shadow-[0_0_10px_rgba(var(--primary-rgb,59,130,246),0.2)] ring-1 ring-primary/20"
                          : "bg-card hover:bg-muted/30",
                        selectionMode &&
                          selectedChats.has(chat.id) &&
                          "bg-primary/10 border-primary/40"
                      )}
                      onClick={() => {
                        if (selectionMode) {
                          toggleSelectChat(chat.id, {
                            stopPropagation: () => {},
                          } as React.MouseEvent);
                        } else if (!editingChatId) {
                          handleChatClick(chat);
                        }
                      }}
                    >
                      {/* Chat Title Row - Always visible */}
                      <div className="flex items-center gap-1">
                        {/* Selection Checkbox */}
                        {selectionMode && (
                          <button
                            className="shrink-0 p-0.5 mr-1"
                            onClick={(e) => toggleSelectChat(chat.id, e)}
                          >
                            {selectedChats.has(chat.id) ? (
                              <CheckSquare className="h-4 w-4 text-primary" />
                            ) : (
                              <Square className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        )}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          {editingChatId === chat.id ? (
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Input
                                ref={editInputRef}
                                value={editingTitle}
                                onChange={(e) =>
                                  setEditingTitle(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleRename(chat.id);
                                  } else if (e.key === "Escape") {
                                    cancelEditing();
                                  }
                                }}
                                className="h-6 text-xs font-medium flex-1 min-w-0"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-primary hover:text-primary shrink-0"
                                onClick={() => handleRename(chat.id)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground shrink-0"
                                onClick={cancelEditing}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <h4 className="font-medium text-xs truncate">
                              {chat.title}
                            </h4>
                          )}
                        </div>

                        {/* Action Buttons - Edit and Delete - Always visible */}
                        {editingChatId !== chat.id && (
                          <div className="flex items-center shrink-0 -mr-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClick(chat, e);
                              }}
                              title="Rename chat"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(chat.id, chat.title);
                              }}
                              title="Delete chat"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Expandable Details - Hidden by default, shown on hover */}
                      {editingChatId !== chat.id && (
                        <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-all duration-300 ease-in-out">
                          <div className="overflow-hidden">
                            {/* Preview Text */}
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                              {getPreviewText(chat)}
                            </p>

                            {/* Metadata Row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75">
                              <div
                                className="flex items-center gap-1"
                                title={formatFullDate(chat.updatedAt)}
                              >
                                <Calendar className="h-3 w-3" />
                                <span>{formatDate(chat.updatedAt)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <MessageCircle className="h-3 w-3" />
                                <span>
                                  {chat.messages.length} msg
                                  {chat.messages.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                              {chat.documentContext.filenames.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  <span>
                                    {chat.documentContext.filenames.length} doc
                                    {chat.documentContext.filenames.length !== 1
                                      ? "s"
                                      : ""}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Document filenames preview */}
                            {chat.documentContext.filenames.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100">
                                {chat.documentContext.filenames
                                  .slice(0, 2)
                                  .map((filename, idx) => (
                                    <Badge
                                      key={idx}
                                      variant="outline"
                                      className="text-[10px] py-0 h-4 font-normal truncate max-w-[100px]"
                                      title={filename}
                                    >
                                      {filename}
                                    </Badge>
                                  ))}
                                {chat.documentContext.filenames.length > 2 && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] py-0 h-4 font-normal"
                                  >
                                    +{chat.documentContext.filenames.length - 2}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog - Improved for mobile */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => !isDeleting && setDeleteDialogOpen(open)}
      >
        <AlertDialogContent className="max-w-[90vw] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Chat
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <p>
                Are you sure you want to delete{" "}
                <strong>"{chatToDeleteTitle}"</strong>?
              </p>
              <p className="text-sm">This will permanently remove:</p>
              <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                <li>All messages in this conversation</li>
                <li>Associated PDF documents and embeddings</li>
                <li>Chat context from the backend</li>
              </ul>
              <p className="text-sm font-medium text-destructive">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              className="w-full sm:w-auto"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Permanently
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={(open) => !isDeleting && setBulkDeleteDialogOpen(open)}
      >
        <AlertDialogContent className="max-w-[90vw] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete {selectedChats.size} Chat
              {selectedChats.size !== 1 ? "s" : ""}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <p>
                Are you sure you want to delete{" "}
                <strong>
                  {selectedChats.size} selected conversation
                  {selectedChats.size !== 1 ? "s" : ""}
                </strong>
                ?
              </p>
              <p className="text-sm">This will permanently remove:</p>
              <ul className="text-sm list-disc list-inside space-y-1 text-muted-foreground">
                <li>All messages in these conversations</li>
                <li>Associated PDF documents and embeddings</li>
                <li>Chat contexts from the backend</li>
              </ul>
              <p className="text-sm font-medium text-destructive">
                This action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              className="w-full sm:w-auto"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              disabled={isDeleting}
              className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {selectedChats.size} Chat
                  {selectedChats.size !== 1 ? "s" : ""}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
