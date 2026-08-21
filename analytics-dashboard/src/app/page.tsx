import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPaymentRowCount, getDatabasePath } from "@/data/db";
import { getMerchantPrioritySample } from "@/metrics/merchant-summary";

export default function Home() {
  const rowCount = getPaymentRowCount();
  const merchants = getMerchantPrioritySample();

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-2">
          <Badge variant="secondary">Scaffold ready</Badge>
          <h1 className="text-3xl font-bold tracking-tight">ZarinPal Merchant Ops Dashboard</h1>
          <p className="text-sm text-slate-600">
            SQLite source: {getDatabasePath()}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Rows</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{rowCount.toLocaleString()}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schema</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">payments table exists and is readable</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>App state</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">Scaffold only, no product UI yet</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Merchant priority sample</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {merchants.map((merchant) => (
                <div key={merchant.merchant_key} className="flex items-center justify-between rounded-md border p-3">
                  <span className="font-medium">{merchant.merchant_key}</span>
                  <div className="flex gap-4 text-sm text-slate-600">
                    <span>{merchant.sessions} sessions</span>
                    <span>{merchant.fail_rate}% fail rate</span>
                    <span>{merchant.failed_value.toLocaleString()} IRR failed</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
