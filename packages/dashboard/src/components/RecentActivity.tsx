interface Props {
  logs: any[];
}

export default function RecentActivity({ logs }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
      {logs.length === 0 ? (
        <p className="text-gray-400 text-sm">No activity yet.</p>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {log.model}
                </p>
                <p className="text-xs text-gray-500">
                  {new Date(log.createdAt).toLocaleString()} &middot; {log.durationMs}ms
                </p>
              </div>
              <div className="text-right ml-4">
                <p className="text-sm font-medium text-gray-700">
                  {(log.inputTokens + log.outputTokens).toLocaleString()} tokens
                </p>
                <p className="text-xs text-gray-400">
                  ${(log.costCents / 100).toFixed(4)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
