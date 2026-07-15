const formatCurrency = (amount: any): string => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
};

console.log("String:", formatCurrency("1598"));
console.log("Number:", formatCurrency(1598));
try {
  console.log("Object:", formatCurrency({ d: [1598], e: 3, s: 1 }));
} catch (e) {
  console.log("Object failed");
}
