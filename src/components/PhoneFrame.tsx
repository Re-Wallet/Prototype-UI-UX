import React from 'react';
import { Wifi, BatteryMedium, Signal } from 'lucide-react';

interface PhoneFrameProps {
  children: React.ReactNode;
  isFramed?: boolean;
}

export const PhoneFrame: React.FC<PhoneFrameProps> = ({ children, isFramed = true }) => {
  if (!isFramed) {
    return <div className="w-full min-h-screen bg-black text-white">{children}</div>;
  }

  return (
    <div className="relative mx-auto w-full max-w-[400px] h-[852px] bg-black rounded-[52px] p-3 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_0_12px_#1c1c1e,0_0_0_14px_#2c2c2e] border border-white/10 flex flex-col overflow-hidden select-none">
      {/* Dynamic Island and Status Bar */}
      <div className="relative z-30 shrink-0 h-11 px-6 flex items-center justify-between text-white text-[13px] font-semibold tracking-tight select-none pt-1">
        {/* Time matching screenshot */}
        <span>09:41</span>

        {/* Dynamic Island Capsule */}
        <div className="absolute left-1/2 -translate-x-1/2 top-2.5 w-24 h-6 bg-black rounded-full border border-white/5 flex items-center justify-center">
          <div className="w-2.5 h-2.5 rounded-full bg-[#121214] ml-auto mr-2.5" />
        </div>

        {/* Status icons matching screenshot */}
        <div className="flex items-center gap-1.5 text-zinc-200">
          <Signal className="w-3.5 h-3.5" />
          <Wifi className="w-3.5 h-3.5" />
          {/* Green Battery with bolt like screenshot */}
          <div className="flex items-center text-[#34c759]">
            <BatteryMedium className="w-4 h-4 fill-current" />
          </div>
        </div>
      </div>

      {/* Screen Viewport with native touch feel */}
      <div className="relative flex-1 bg-black text-white overflow-hidden flex flex-col rounded-[40px]">
        {children}
      </div>

      {/* Bottom Home Indicator Bar */}
      <div className="shrink-0 h-4 flex items-center justify-center pb-1">
        <div className="w-32 h-1 bg-white/30 rounded-full" />
      </div>
    </div>
  );
};
