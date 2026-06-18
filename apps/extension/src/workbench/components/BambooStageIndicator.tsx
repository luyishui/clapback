import { useEffect, useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import "./BambooStageIndicator.css";

interface BambooStageIndicatorProps {
  status: "pending" | "active" | "done" | "failed";
  stageIndex: number;
}

/**
 * 水墨毛笔竹加载指示器。
 *
 * 用 SVG path 画出真正毛笔笔触的竹子(竹竿多节 + 经典撇叶),
 * 配合原生 stroke-dasharray/offset 技术(等效 DrawSVG,无需插件)
 * 实现"逐节描画生长"的动效。
 *
 * 状态:
 *  - pending: 半透明轮廓
 *  - active:  从下到上逐节描画 → 竹叶长出 → idle 时如风吹轻摇
 *  - done:    墨色 → 山绿渐变
 *  - failed:  竹竿晕散 + 竹叶枯萎下垂
 *
 * 所有动画均通过 gsap.matchMedia() 包裹,
 * 在 prefers-reduced-motion: reduce 下瞬时降级(design.md §8 / a11y CRITICAL)。
 */
export function BambooStageIndicator({ status, stageIndex }: BambooStageIndicatorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // 竹竿节(stroke)集合 —— active 时逐节描画
  const segmentsRef = useRef<SVGPathElement[]>([]);
  // 竹叶(stroke + fill)集合 —— 竹竿描完后长出
  const leavesRef = useRef<SVGPathElement[]>([]);
  // 整株根节点,用于 done/failed 的整体变换与上色
  const rootRef = useRef<SVGGElement>(null);

  // 在首次挂载时,根据每段 path 的真实长度初始化 stroke-dasharray,
  // 让 GSAP 后续只操控 stroke-dashoffset 即可"擦出/画上"。
  useLayoutEffect(() => {
    const all = [...segmentsRef.current, ...leavesRef.current];
    all.forEach((path) => {
      const len = getPathLength(path);
      // 留作 CSS 兜底(GSAP 未接管时也能呈现"未描"状态)
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const root = rootRef.current;
    if (!svg || !root) return;

    const segments = segmentsRef.current;
    const leaves = leavesRef.current;
    const targets = [...segments, ...leaves];

    // 清理上一轮动画与失败态类名
    gsap.killTweensOf([root, ...targets]);
    root.classList.remove("bamboo-svg--cracked");

    // 计算每段 path 的总长(描画动画需要)
    const segLens = segments.map(getPathLength);
    const leafLens = leaves.map(getPathLength);

    const mm = gsap.matchMedia();

    mm.add(
      {
        // 正常动效环境
        animateMotion: "(prefers-reduced-motion: no-preference)",
        // 降级环境:瞬时显示,不做循环
        reducedMotion: "(prefers-reduced-motion: reduce)",
      },
      (ctx) => {
        const { reducedMotion } = ctx.conditions as {
          animateMotion: boolean;
          reducedMotion: boolean;
        };
        const dur = reducedMotion ? 0 : 0.34;

        // ---- 公共:重置描边与颜色起点 ----
        // 轮廓墨色(焦墨),失败态会被后续覆盖
        gsap.set(targets, {
          stroke: "var(--ink-focus, #1a1a1a)",
          fill: "rgba(26, 26, 26, 0.04)",
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          transformOrigin: "bottom center",
        });
        gsap.set(root, { filter: "none", rotation: 0, transformOrigin: "bottom center" });

        if (status === "pending") {
          // 半透明轮廓:全部 stroke-dashoffset 归位(显示完整轮廓但很淡)
          gsap.set(targets, {
            opacity: 0.16,
            strokeDashoffset: 0,
            fill: "transparent",
          });
          return;
        }

        if (status === "active") {
          // 竹竿逐节描画:从满偏移(看不见)画到 0(完整)
          // 用 stagger 让每一节顺次生长
          segments.forEach((path, i) => {
            gsap.fromTo(
              path,
              { strokeDashoffset: segLens[i] },
              {
                strokeDashoffset: 0,
                duration: dur,
                ease: "power2.out",
                delay: reducedMotion ? 0 : 0.06 * i,
              },
            );
          });

          // 竹叶在竹竿描完后(总 delay ≈ 0.06*(n-1)+dur)按撇的笔序逐片长出
          const leafStart = reducedMotion ? 0 : 0.06 * Math.max(0, segments.length - 1) + dur;
          leaves.forEach((path, i) => {
            gsap.fromTo(
              path,
              { strokeDashoffset: leafLens[i], fill: "rgba(26,26,26,0)" },
              {
                strokeDashoffset: 0,
                fill: "rgba(26, 26, 26, 0.06)",
                duration: reducedMotion ? 0 : 0.26,
                ease: "power1.out",
                delay: leafStart + (reducedMotion ? 0 : 0.12 * i),
              },
            );
          });

          // idle 轻摇:整株如风吹(仅非降级环境)
          if (!reducedMotion) {
            gsap.to(root, {
              rotation: 0.7,
              duration: 2.4,
              ease: "sine.inOut",
              yoyo: true,
              repeat: -1,
              transformOrigin: "bottom center",
              delay: leafStart + 0.12 * leaves.length,
            });
          }
          return;
        }

        if (status === "done") {
          // 已描到位 + 墨色 → 山绿渐变 + 轻摇停止
          gsap.set(targets, { strokeDashoffset: 0, fill: "rgba(46,139,87,0.06)" });
          gsap.to(targets, {
            stroke: "var(--mountain-green, #2E8B57)",
            duration: 0.3,
            ease: "power2.out",
          });
          gsap.to(root, { rotation: 0, duration: 0.3, ease: "power2.out" });
          return;
        }

        // ---- failed ----
        root.classList.add("bamboo-svg--cracked");
        // 竹竿晕散:模糊 + 缩短
        gsap.set(targets, { strokeDashoffset: 0 });
        gsap.to(root, {
          filter: "blur(0.6px)",
          duration: 0.3,
          ease: "power2.in",
        });
        gsap.to(segments, {
          scaleY: 0.62,
          y: 3,
          duration: 0.3,
          ease: "power2.in",
          stagger: 0.04,
          transformOrigin: "bottom center",
        });
        // 竹叶枯萎:下垂 + 旋转 + 透明度下降
        gsap.to(leaves, {
          rotation: (i) => (i % 2 === 0 ? -16 : 16),
          opacity: 0.32,
          y: 4,
          duration: 0.4,
          ease: "power2.in",
          stagger: 0.08,
          transformOrigin: "bottom center",
        });
      },
    );

    return () => {
      mm.revert();
    };
  }, [status, stageIndex]);

  return (
    <svg
      ref={svgRef}
      className={`bamboo-svg bamboo-svg--${status}`}
      viewBox="0 0 32 44"
      width="32"
      height="44"
      aria-hidden="true"
    >
      <g ref={rootRef} className="bamboo-svg__root">
        {/* 竹竿:4 节,自下而上。每节是垂直 path + 顶端竹节横纹 */}
        <g className="bamboo-svg__segments">
          <path
            ref={(el) => {
              if (el) segmentsRef.current[0] = el;
            }}
            className="bamboo-svg__segment"
            d="M16 42 L16 33"
          />
          <path
            ref={(el) => {
              if (el) segmentsRef.current[1] = el;
            }}
            className="bamboo-svg__segment"
            d="M16 33 L16 24 M13.4 33 L18.6 33"
          />
          <path
            ref={(el) => {
              if (el) segmentsRef.current[2] = el;
            }}
            className="bamboo-svg__segment"
            d="M16 24 L16 15 M13.6 24 L18.4 24"
          />
          <path
            ref={(el) => {
              if (el) segmentsRef.current[3] = el;
            }}
            className="bamboo-svg__segment"
            d="M16 15 L16 7 M13.8 15 L18.2 15"
          />
        </g>

        {/* 竹叶:经典撇叶形,左上 + 右上两组,呈"个"字布局 */}
        <g className="bamboo-svg__leaves">
          {/* 左上叶 */}
          <path
            ref={(el) => {
              if (el) leavesRef.current[0] = el;
            }}
            className="bamboo-svg__leaf"
            d="M16 9 C12 7 8 6 5 8 C8 8.5 11 9 14 11 Z"
          />
          {/* 右上叶 */}
          <path
            ref={(el) => {
              if (el) leavesRef.current[1] = el;
            }}
            className="bamboo-svg__leaf"
            d="M16 9 C20 7 24 6 27 8 C24 8.5 21 9 18 11 Z"
          />
          {/* 顶心叶 */}
          <path
            ref={(el) => {
              if (el) leavesRef.current[2] = el;
            }}
            className="bamboo-svg__leaf"
            d="M16 7 C15.4 4 15.4 2 16 1 C16.6 2 16.6 4 16 7 Z"
          />
        </g>
      </g>
    </svg>
  );
}

function getPathLength(path: SVGPathElement): number {
  return typeof path.getTotalLength === "function" ? path.getTotalLength() : 1;
}
