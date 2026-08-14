import { useEffect, useRef, useState } from "react";
import { useToast, dismiss as dismissToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";

const iconByType = {
  success: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
  error: <AlertCircle className="w-5 h-5 text-red-500" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-500" />,
  info: <Info className="w-5 h-5 text-blue-500" />,
};
const barByType = {
  success: "bg-emerald-500",
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

function ToastItem({ id, title, description, type, duration, ...props }) {
  const [progress, setProgress] = useState(100);
  const rafRef = useRef();
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setProgress(100);
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / (duration || 3000)) * 100);
      setProgress(pct);
      if (pct > 0) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [duration, id]);

  return (
    <Toast {...props}>
      <div className="flex items-start gap-3 w-full">
        {iconByType[type] || iconByType.info}
        <div className="grid gap-1 flex-1 min-w-0">
          {title && <ToastTitle>{title}</ToastTitle>}
          {description && <ToastDescription>{description}</ToastDescription>}
        </div>
      </div>
      <ToastClose onClick={() => dismissToast(id)} />
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/5 overflow-hidden">
        <div
          className={`h-full transition-none ${barByType[type] || barByType.info}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </Toast>
  );
}

export function Toaster() {
  const { toasts } = useToast();
  return (
    <ToastProvider>
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}