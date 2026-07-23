import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useSalesHistory } from "../hooks/useSales";
import { useTableState } from "@/hooks/useTableState";
import { useDebounce } from "@/hooks/useDebounce";
import { DataTable, ColumnDef } from "@/components/shared/DataTable/DataTable";
import { SearchBox } from "@/components/ui/SearchBox";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { SaleHistoryRowModel } from "../types";

export default function SalesHistoryView() {
  const navigate = useNavigate();
  const tableState = useTableState(10);
  
  // Local state for immediate input feedback, synchronized with debounced URL state
  const [searchValue, setSearchValue] = useState(tableState.search);
  const debouncedSearch = useDebounce(searchValue, 500);

  // Sync debounced search to URL
  useEffect(() => {
    if (debouncedSearch !== tableState.search) {
      tableState.setFilters({ search: debouncedSearch });
    }
  }, [debouncedSearch, tableState]);

  // Sync URL to local state if URL changes externally
  useEffect(() => {
    setSearchValue(tableState.search);
  }, [tableState.search]);

  // Fetch data
  const { data, isLoading } = useSalesHistory({
    page: tableState.page,
    limit: tableState.limit,
    search: tableState.search,
    status: tableState.status,
  });

  const columns: ColumnDef<SaleHistoryRowModel>[] = [
    {
      key: "invoice",
      header: "Invoice",
      cell: (row) => <span className="font-medium text-blue-600">{row.invoiceNumber}</span>,
    },
    {
      key: "date",
      header: "Date",
      cell: (row) => new Date(row.date).toLocaleString(),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.customerName}</span>
          {row.customerPhone && <span className="text-xs text-muted-foreground">{row.customerPhone}</span>}
        </div>
      ),
    },
    {
      key: "cashier",
      header: "Cashier",
      cell: (row) => row.cashierName,
    },
    {
      key: "payments",
      header: "Payment",
      cell: (row) => (
        <div className="flex gap-1 flex-wrap">
          {row.paymentMethods.map((pm) => (
            <Badge key={pm} variant={pm === "CASH" ? "success" : pm === "UPI" ? "info" : "default"}>
              {pm}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      cell: (row) => <span className="font-bold">₹{row.totalAmount.toFixed(2)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={row.status === "COMPLETED" ? "success" : row.status === "CANCELLED" ? "error" : "warning"}>
          {row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Sales History</h1>
      </div>

      <div className="flex flex-wrap items-center gap-4 bg-card p-4 rounded-lg border border-border">
        <div className="flex-1 min-w-[250px]">
          <SearchBox
            value={searchValue}
            onChange={setSearchValue}
            placeholder="Search invoice, customer, phone..."
          />
        </div>
        
        <div className="w-48">
          <Select
            value={tableState.status}
            onChange={(e) => tableState.setFilters({ status: e.target.value })}
            options={[
              { value: "", label: "All Statuses" },
              { value: "COMPLETED", label: "Completed" },
              { value: "CANCELLED", label: "Voided / Cancelled" },
              { value: "REFUNDED", label: "Refunded" },
              { value: "EXCHANGED", label: "Exchanged" },
            ]}
          />
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border flex-1 overflow-hidden">
        <div className="p-4">
          <DataTable
            columns={columns}
            data={data?.data || []}
            isLoading={isLoading}
            totalItems={data?.total || 0}
            itemsPerPage={tableState.limit}
            currentPage={tableState.page}
            onPageChange={tableState.setPage}
            onRowClick={(row) => navigate(`/sales/${row.id}`)}
          />
        </div>
      </div>
    </div>
  );
}
