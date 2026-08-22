"use client";

import { useEffect, useRef } from "react";

/**
 * Fixed full-viewport animated WebGL shader background, lifted from the
 * <script data-purpose="shader-integration"> block shared verbatim by
 * alpha_court_pro_landing_enhanced and leaderboard_reputation_rankings_vibrant_v2.
 */
export function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function syncSize() {
      if (!canvas) return;
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    window.addEventListener("resize", syncSize);
    syncSize();

    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return;

    const vs = `attribute vec2 a_position; varying vec2 v_texCoord; void main() { v_texCoord = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }`;

    const fs = `precision highp float;
      uniform float u_time;
      varying vec2 v_texCoord;
      void main() {
          vec2 uv = v_texCoord;
          vec3 color1 = vec3(0.07, 0.04, 0.09);
          vec3 color2 = vec3(0.12, 0.05, 0.15);
          float flow = sin(uv.x * 5.0 + u_time * 0.5) * 0.5 + 0.5;
          float flow2 = cos(uv.y * 3.0 - u_time * 0.3) * 0.5 + 0.5;
          vec3 bgColor = mix(color1, color2, flow * flow2);

          float pulse = sin(u_time * 1.5) * 0.5 + 0.5;
          vec3 accent = vec3(0.74, 0.0, 1.0);

          float gridX = step(0.98, fract(uv.x * 20.0));
          float gridY = step(0.98, fract(uv.y * 20.0));
          float grid = (gridX + gridY) * 0.05;

          float noise = fract(sin(dot(uv + u_time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
          float highlights = step(0.999, noise) * pulse;

          vec3 finalColor = bgColor + grid + (accent * highlights * 0.5);
          gl_FragColor = vec4(finalColor, 1.0);
      }`;

    function cs(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const pos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");

    let raf = 0;
    function render(t: number) {
      if (!gl || !canvas) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    }
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncSize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="global-shader-bg"
      className="fixed top-0 left-0 w-screen h-screen -z-10 pointer-events-none opacity-80"
    />
  );
}
