import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { formatCooldownRemaining } from "@/shared/utils/cooldown";

export default function CooldownTimer({ until }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const updateRemaining = () => setRemaining(formatCooldownRemaining(until));

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [until]);

  if (!remaining) return null;

  return (
    <span className="text-xs text-orange-500 font-mono">
      ⏱ {remaining}
    </span>
  );
}

CooldownTimer.propTypes = {
  until: PropTypes.string.isRequired,
};
