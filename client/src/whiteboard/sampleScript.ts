// Built-in sample script demonstrating JSXGraph-assisted geometry construction.
import type { WhiteboardScript } from "./commandTypes";

const A: [number, number] = [735, 162];
const B: [number, number] = [552, 520];
const C: [number, number] = [1036, 520];
const D: [number, number] = [794, 681];
const O: [number, number] = [794, 418];

export const sampleScript: WhiteboardScript = {
  canvas: {
    width: 1200,
    height: 820,
    background: "#ffffff",
  },
  pages: [{ id: "reconstruct", title: "几何题图形重构" }],
  commands: [
    {
      type: "switch_page",
      id: "page_reconstruct",
      pageId: "reconstruct",
      duration: 200,
    },
    {
      type: "write_text",
      id: "title",
      text: "JSXGraph 辅助：几何题图形重构",
      x: 58,
      y: 70,
      fontSize: 34,
      color: "#111111",
      bold: true,
      duration: 500,
      narration: "这次不用手动估每一个垂足和交点，而是让几何构造层先计算，再交给白板绘制。",
    },
    {
      type: "write_text",
      id: "recognition_note",
      text: "输入：A、B、C、D、O 的大致点位 + 外接圆、垂足、交点、虚线连接等几何关系。",
      x: 58,
      y: 114,
      fontSize: 22,
      color: "#475569",
      duration: 500,
    },
    {
      type: "construct_geometry",
      id: "geo_rebuild",
      points: [
        { id: "A", x: A[0], y: A[1], label: "A", labelPosition: "top" },
        { id: "B", x: B[0], y: B[1], label: "B", labelPosition: "bottom" },
        { id: "C", x: C[0], y: C[1], label: "C", labelPosition: "bottom" },
        { id: "D", x: D[0], y: D[1], label: "D", labelPosition: "bottom" },
        { id: "O", x: O[0], y: O[1], label: "O", labelPosition: "right" },
      ],
      constructions: [
        { kind: "circumcircle", id: "circumcircle", through: ["A", "B", "C"], color: "#334155", width: 4 },
        { kind: "segment", id: "AB", from: "A", to: "B", width: 4 },
        { kind: "segment", id: "AC", from: "A", to: "C", width: 4 },
        { kind: "segment", id: "BC", from: "B", to: "C", width: 4 },
        {
          kind: "perpendicular_projection",
          id: "AE",
          point: "A",
          line: ["B", "C"],
          footId: "E",
          footLabel: "E",
          drawSegment: true,
          markRightAngle: true,
          width: 4,
        },
        {
          kind: "perpendicular_projection",
          id: "CF",
          point: "C",
          line: ["A", "B"],
          footId: "F",
          footLabel: "F",
          footLabelPosition: "left",
          drawSegment: true,
          markRightAngle: true,
          width: 4,
        },
        { kind: "intersection", id: "H", lines: [["A", "E"], ["C", "F"]], label: "H", labelPosition: "left" },
        { kind: "segment", id: "AD", from: "A", to: "D", width: 4 },
        { kind: "segment", id: "HD", from: "H", to: "D", width: 4 },
        { kind: "segment", id: "dash_BH", from: "B", to: "H", dashed: true, width: 3 },
        { kind: "segment", id: "dash_BO", from: "B", to: "O", dashed: true, width: 3 },
        { kind: "segment", id: "dash_OC", from: "O", to: "C", dashed: true, color: "#64748b", width: 2 },
        { kind: "segment", id: "dash_OD", from: "O", to: "D", dashed: true, color: "#64748b", width: 2 },
        { kind: "segment", id: "dash_DB", from: "D", to: "B", dashed: true, width: 3 },
        { kind: "segment", id: "dash_DC", from: "D", to: "C", dashed: true, width: 3 },
        { kind: "segment", id: "dash_AO", from: "A", to: "O", dashed: true, width: 3 },
        { kind: "highlight_polygon", id: "highlight_AHD", points: ["A", "H", "D"], fill: "#bfdbfe", fillOpacity: 0.22 },
      ],
      duration: 360,
      narration: "构造层会自动求出 E、F 两个垂足，以及 AE 和 CF 的交点 H，再把整张几何图画出来。",
    },
    {
      type: "laser_pointer",
      id: "laser_AE_CF",
      x: A[0],
      y: A[1],
      path: [A, [735, 520], [594, 398], C],
      style: "pulse",
      color: "#ef4444",
      radius: 10,
      duration: 1600,
      narration: "激光笔先扫过 AE，再扫过 CF，这两条垂线决定了交点 H 的位置。",
    },
    {
      type: "laser_pointer",
      id: "laser_AHD",
      x: A[0],
      y: A[1],
      path: [A, [735, 430], D, A],
      style: "ring",
      color: "#ef4444",
      radius: 11,
      duration: 1500,
      narration: "目标三角形 AHD 已经高亮出来，后续证明就围绕 AH 和 HD 的关系展开。",
    },
  ],
};

export const sampleScriptString = JSON.stringify(sampleScript, null, 2);
