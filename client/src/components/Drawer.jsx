import { motion, AnimatePresence } from "framer-motion";

/**
 * Reusable slide-up drawer component.
 * Renders above the bottom toolbar (bottom-[60px]).
 *
 * Props:
 *   isOpen    — boolean, whether the drawer is visible
 *   onClose   — callback when backdrop or handle is clicked
 *   maxHeight — CSS max-height string (default "40vh")
 *   title     — optional title shown in the drawer header
 *   children  — drawer content
 */
const Drawer = ({ isOpen, onClose, children, maxHeight = "40vh", title }) => (
  <AnimatePresence>
    {isOpen && (
      <>
        {/* Invisible full-screen backdrop to catch clicks */}
        <motion.div
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ background: "transparent" }}
          onClick={onClose}
        />

        {/* Drawer panel */}
        <motion.div
          className="fixed bottom-[60px] left-0 right-0 z-50 bg-slate-900/90 backdrop-blur-md rounded-t-xl border-t border-white/10 overflow-hidden"
          style={{ maxHeight }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
        >
          {/* Drag handle + optional title */}
          <div
            className="flex flex-col items-center pt-2.5 pb-1 cursor-pointer select-none"
            onClick={onClose}
          >
            <div className="w-8 h-1 bg-white/20 rounded-full" />
            {title && (
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mt-2">
                {title}
              </p>
            )}
          </div>

          {/* Content area */}
          {children}
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default Drawer;
