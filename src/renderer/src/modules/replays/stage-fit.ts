export interface FitBox {
  width: number
  height: number
}

export interface FitRect extends FitBox {
  x: number
  y: number
}

/** Story 170: the largest `aspect` (width / height) rect centred inside `box`, whole pixels. */
export function fitAspect(box: FitBox, aspect: number): FitRect {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  let width = box.width
  let height = width / aspect
  if (height > box.height) {
    height = box.height
    width = height * aspect
  }
  width = Math.floor(width)
  height = Math.floor(height)
  return {
    x: Math.floor((box.width - width) / 2),
    y: Math.floor((box.height - height) / 2),
    width,
    height,
  }
}
