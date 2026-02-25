interface Props {
  summary: any;
  user: any;
}

export default function StatsCards({ summary, user }: Props) {
  const stats = [
    {
      label: 'API Calls This Month',
      value: summary?.callCount?.toLocaleString() || '0',
      icon: '⚡',
      color: 'bg-blue-50 text-blue-700',
    },
    {
      label: 'Tokens Used',
      value: summary?.totalTokens?.toLocaleString() || '0',
      icon: '📊',
      color: 'bg-green-50 text-green-700',
    },
    {
      label: 'Estimated Cost',
      value: `$${((summary?.totalCostCents || 0) / 100).toFixed(2)}`,
      icon: '💰',
      color: 'bg-amber-50 text-amber-700',
    },
    {
      label: 'Credits Remaining',
      value: user?.creditsRemaining?.toLocaleString() || '0',
      icon: '🎯',
      color: 'bg-purple-50 text-purple-700',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3 mb-3">
            <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${stat.color}`}>
              {stat.icon}
            </span>
            <span className="text-sm text-gray-500">{stat.label}</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
