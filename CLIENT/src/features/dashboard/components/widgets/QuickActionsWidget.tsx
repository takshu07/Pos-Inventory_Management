/**
 * @file features/dashboard/components/widgets/QuickActionsWidget.tsx
 *
 * Purpose: Provides fast access to the most common tasks based on user role.
 */

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { QuickAction, WidgetProps } from "../../types";
import { Link } from "react-router";
import * as Icons from "lucide-react";
import { cn } from "@/utils/cn";

interface QuickActionsWidgetProps extends WidgetProps {
  actions: QuickAction[];
}

export function QuickActionsWidget({ actions, className }: QuickActionsWidgetProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3">
          {actions.map((action, idx) => {
            // Dynamically resolve icon from Lucide
            const Icon = (Icons as any)[action.icon] || Icons.CircleDashed;
            
            return (
              <Link 
                key={idx} 
                to={action.href}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all text-center group"
              >
                <div 
                  className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
                  style={{ 
                    backgroundColor: action.color ? `${action.color}15` : "var(--primary-10)",
                    color: action.color || "hsl(var(--primary))" 
                  }}
                >
                  <Icon className="h-5 w-5 group-hover:scale-110 transition-transform" />
                </div>
                <span className="text-xs font-medium text-foreground">{action.label}</span>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
