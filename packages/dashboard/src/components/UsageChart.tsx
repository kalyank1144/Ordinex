import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  data: any[];
}

export default function UsageChart({ data }: Props) {
  const chartData = data.map((d: any) => ({
    date: d.date,
    tokens: (d.input_tokens || 0) + (d.output_tokens || 0),
    calls: d.calls || 0,
  }));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Usage Over Time</h3>
      {chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400">
          No usage data yet. Start using Ordinex to see analytics here.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#4c6ef5" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#4c6ef5" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#9ca3af' }}
              tickFormatter={(v) => v.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#9ca3af' }}
              tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip
              contentStyle={{
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
              }}
              formatter={(value: number) => [value.toLocaleString(), 'Tokens']}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Area
              type="monotone"
              dataKey="tokens"
              stroke="#4c6ef5"
              strokeWidth={2}
              fill="url(#tokenGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
