import { motion, AnimatePresence } from "framer-motion";

/**
 * Reusable slide-up drawer anchored above the bottom toolbar.
 *
 * Props:
 *   isOpen   — boolean, controls visibility
 *   onClose  — called when backdrop or close button clicked
 *   maxHeight — CSS string (default "40vh")
 *   title    — optional header title string
 *   children — drawer body content
 */
export const Drawer = ({ isOpen, onClose, maxHeight = "40vh", title, children }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Transparent backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-30"
            onClick={onClose}
          />

          {/* Sliding panel */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-14 left-0 right-0 z-40 bg-slate-900/80 backdrop-blur-md rounded-t-xl border-t border-slate-700/50 flex flex-col"
            style={{ maxHeight }}
          >
            {title && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 flex-shrink-0">
                <span className="text-white text-sm font-semibold">{title}</span>
                <button
                  onClick={onClose}
                  className="text-slate-400 hover:text-white transition-colors p-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
