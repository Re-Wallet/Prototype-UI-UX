import React from 'react';

interface CoinIconProps {
  className?: string;
  size?: number;
}

export const CoinIcon: React.FC<CoinIconProps> = ({ className = 'w-5 h-5', size }) => {
  const style = size ? { width: size, height: size } : undefined;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block shrink-0 ${className}`}
      style={style}
    >
      {/* Outer coin border */}
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
      {/* Inner fine concentric ring */}
      <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 1.5" opacity="0.6" />
      {/* Dollar / Digital Dollar S symbol with subtle lines */}
      <path
        d="M12 4.8V7M12 17V19.2M14.5 9.2C14.5 8.1 13.4 7.2 12 7.2C10.5 7.2 9.4 8 9.4 9.1C9.4 11.2 14.6 10.4 14.6 12.8C14.6 14.1 13.4 14.9 12 14.9C10.3 14.9 9.3 13.9 9.3 12.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
