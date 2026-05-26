import { useStdout } from "ink";
import { useState, useEffect } from "react";

export function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    rows: stdout?.rows ?? 24,
    cols: stdout?.columns ?? 80,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setSize({ rows: stdout.rows, cols: stdout.columns });
    };
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  return size;
}
