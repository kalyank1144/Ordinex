import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import UsageChart from '../components/UsageChart';
import StatsCards from '../components/StatsCards';
import RecentActivity from '../components/RecentActivity';
import ApiKeysSection from '../components/ApiKeysSection';

export default function DashboardPage() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<any>(null);
  const [dailyData, setDailyData] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [s, d, r] = await Promise.all([
          api.usage.summary(),
          api.usage.daily(30),
          api.usage.recent(20),
        ]);
        setSummary(s);
        setDailyData(d.days);
        setRecentLogs(r.logs);
      } catch {
        // handle silently
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ordinex-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ordinex-800">Ordinex</h1>
            <span className="text-xs bg-ordinex-100 text-ordinex-700 px-2 py-0.5 rounded-full font-medium">
              {user?.plan?.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-gray-500 mt-1">Welcome back, {user?.name}</p>
        </div>

        <StatsCards summary={summary} user={user} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <UsageChart data={dailyData} />
          </div>
          <div>
            <SubscriptionCard user={user} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RecentActivity logs={recentLogs} />
          <ApiKeysSection />
        </div>
      </main>
    </div>
  );
}

function SubscriptionCard({ user }: { user: any }) {
  const planColors: Record<string, string> = {
    free: 'bg-gray-100 text-gray-700',
    pro: 'bg-ordinex-100 text-ordinex-700',
    team: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Subscription</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Current Plan</span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${planColors[user?.plan] || planColors.free}`}>
            {user?.plan?.charAt(0).toUpperCase() + user?.plan?.slice(1)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Credits Remaining</span>
          <span className="text-sm font-semibold text-gray-900">
            {user?.creditsRemaining?.toLocaleString()}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-ordinex-500 h-2 rounded-full transition-all"
            style={{ width: `${Math.min((user?.creditsRemaining / 10000) * 100, 100)}%` }}
          />
        </div>
        <button className="w-full py-2 bg-ordinex-600 hover:bg-ordinex-700 text-white text-sm font-medium rounded-lg transition-colors">
          Upgrade Plan
        </button>
      </div>
    </div>
  );
}
