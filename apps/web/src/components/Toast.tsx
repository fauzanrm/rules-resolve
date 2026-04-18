"use client";

import { useEffect } from "react";

interface ToastProps {
  message: string;
  type: "success" | "error";
  visible: boolean;
  onDismiss?: () => void;
}

export default function Toast({ message, type, visible, onDismiss }: ToastProps) {
  useEffect(() => {
    if (visible && type === "success" && onDismiss) {
      const timer = setTimeout(onDismiss, 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, type, onDismiss]);

  if (!visible) return null;

  return <div className={`toast toast-${type}`} role="status">{message}</div>;
}
