export type Employee = {
    id: string;
    name: string;
    email: string;
    password: string;
    role: "ADMIN" | "MANAGER" | "CASHIER";
    isActive: boolean;
};

export const employees: Employee[] = [];