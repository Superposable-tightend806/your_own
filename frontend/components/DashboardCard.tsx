"use client";

import { useRouter } from "next/navigation";

interface DashboardCardProps {
  title: string;
  subtitle?: string;
  className?: string;
  delay?: number;
  href?: string; // if provided, clicking navigates here
}

export function DashboardCard({
  title,
  subtitle,
  className = "",
  delay = 0,
  href,
}: DashboardCardProps) {
  const router = useRouter();

  return (
    <div
      onClick={() => href && router.push(href)}
      className={`
        anim-card
        group relative flex flex-col justify-end p-6
        border border-white/20 bg-black
        select-none
        transition-colors duration-500 ease-out
        hover:border-white/70 hover:bg-white/[0.025]
        ${href ? "cursor-pointer" : "cursor-default"}
        ${className}
      `}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col gap-[5px]">
        <span
          className="
            text-[1.35rem] font-light tracking-[0.22em]
            text-white/75 uppercase
            transition-colors duration-500
            group-hover:text-white
          "
        >
          {title}
        </span>
        {subtitle && (
          <span
            className="
              text-[0.7rem] font-light tracking-[0.18em]
              text-white/30 uppercase
              transition-colors duration-500
              group-hover:text-white/45
            "
          >
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
