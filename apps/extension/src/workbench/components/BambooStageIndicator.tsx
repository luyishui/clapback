import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import "./BambooStageIndicator.css";

interface BambooStageIndicatorProps {
  status: "pending" | "active" | "done" | "failed";
  stageIndex: number;
}

export function BambooStageIndicator({ status, stageIndex }: BambooStageIndicatorProps) {
  const bambooRef = useRef<HTMLDivElement>(null);
  const leavesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bambooRef.current || !leavesRef.current) return;

    const bamboo = bambooRef.current;
    const leaves = leavesRef.current.children;

    // 清除之前的动画和状态类
    gsap.killTweensOf([bamboo, leaves]);
    bamboo.classList.remove("bamboo-cracked");

    if (status === "active") {
      // 进行中：双叶对生呼吸动画（1.4s完整周期）
      gsap.to(leaves[0], {
        scale: 1.15,
        opacity: 1,
        duration: 1.4,
        ease: "power1.inOut",
        yoyo: true,
        repeat: -1,
      });

      gsap.to(leaves[1], {
        scale: 1.15,
        opacity: 1,
        duration: 1.4,
        ease: "power1.inOut",
        yoyo: true,
        repeat: -1,
      });

      // 竹节颜色保持seal-red
      gsap.set(bamboo, {
        backgroundColor: "var(--seal-red)",
        borderColor: "rgba(196, 30, 58, 0.4)",
      });
    } else if (status === "done") {
      // 已完成：从红到绿的渐变 + 竹叶静止
      gsap.to(bamboo, {
        backgroundColor: "var(--mountain-green)",
        borderColor: "rgba(46, 139, 87, 0.4)",
        duration: 0.22,
        ease: "power2.out",
      });

      gsap.to(leaves, {
        scale: 1,
        opacity: 0.9,
        duration: 0.22,
        ease: "power2.out",
      });
    } else if (status === "failed") {
      // 失败：竹节断裂 + 竹叶枯萎
      gsap.to(bamboo, {
        backgroundColor: "var(--seal-red)",
        scaleY: 0.6,
        y: 3,
        duration: 0.3,
        ease: "power2.in",
      });

      // 添加裂纹效果（通过CSS类）
      bamboo.classList.add("bamboo-cracked");

      gsap.to(leaves, {
        scale: 0.7,
        opacity: 0.3,
        rotation: (i) => (i === 0 ? -15 : 15),
        y: 6,
        duration: 0.4,
        ease: "power2.in",
        stagger: 0.1,
      });
    } else {
      // pending：透明轮廓
      gsap.set(bamboo, {
        backgroundColor: "transparent",
        borderColor: "rgba(26, 26, 26, 0.15)",
      });
      gsap.set(leaves, { opacity: 0 });
    }

    // 清理函数：组件卸载时杀死所有动画
    return () => {
      gsap.killTweensOf([bamboo, leaves]);
      bamboo.classList.remove("bamboo-cracked");
    };
  }, [status]);

  return (
    <div className={`bamboo-indicator bamboo-indicator--${status}`}>
      <div ref={bambooRef} className="bamboo-node">
        <div className="bamboo-segment"></div>
      </div>
      <div ref={leavesRef} className="bamboo-leaves">
        <div className="bamboo-leaf bamboo-leaf--left"></div>
        <div className="bamboo-leaf bamboo-leaf--right"></div>
      </div>
    </div>
  );
}
