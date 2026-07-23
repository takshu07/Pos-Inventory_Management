import { InvoiceDetailModel } from "../../types";
import { Card } from "@/components/ui/Card";

export function CustomerCard({ customer }: { customer: any }) {
  const isWalkIn = !customer || customer.isWalkIn;

  return (
    <Card className="p-4 flex flex-col gap-2">
      <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Customer Info</h3>
      {!isWalkIn ? (
        <>
          <div className="font-semibold text-lg">{customer.name}</div>
          <div className="text-muted-foreground">{customer.phone || "No phone provided"}</div>
        </>
      ) : (
        <div className="font-semibold text-lg text-muted-foreground">Walk-in Customer</div>
      )}
    </Card>
  );
}

export function CashierCard({ employee }: { employee: InvoiceDetailModel["employee"] }) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Cashier Info</h3>
      {employee ? (
        <>
          <div className="font-semibold text-lg">{employee.firstName} {employee.lastName}</div>
          <div className="text-muted-foreground">Employee ID: {employee.id.slice(-6).toUpperCase()}</div>
        </>
      ) : (
        <div className="font-semibold text-lg text-muted-foreground">System</div>
      )}
    </Card>
  );
}
