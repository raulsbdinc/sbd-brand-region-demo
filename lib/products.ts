export interface Product {
  id: string
  name: string
  blurb: string
  price: number
  image: string
}

export const PRODUCTS: Product[] = [
  {
    id: "drill",
    name: "20V Brushless Drill/Driver",
    blurb: "Compact, high-torque drilling for everyday jobs.",
    price: 149,
    image: "/products/drill.png",
  },
  {
    id: "driver",
    name: "20V Impact Driver",
    blurb: "Fast, controlled fastening with three speed modes.",
    price: 129,
    image: "/products/driver.png",
  },
  {
    id: "saw",
    name: "20V Circular Saw",
    blurb: "Clean, straight cuts through framing lumber.",
    price: 179,
    image: "/products/saw.png",
  },
]
