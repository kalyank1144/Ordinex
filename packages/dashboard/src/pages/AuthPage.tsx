import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await signup(email, password, name);
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ordinex-50 to-ordinex-100 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-ordinex-800">Ordinex</h1>
          <p className="text-gray-600 mt-2">AI-powered development assistant</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                isLogin ? 'bg-white shadow text-ordinex-700' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => { setIsLogin(true); setError(''); }}
            >
              Sign In
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                !isLogin ? 'bg-white shadow text-ordinex-700' : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => { setIsLogin(false); setError(''); }}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ordinex-400 focus:border-transparent outline-none transition"
                  placeholder="Your name"
                  required={!isLogin}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ordinex-400 focus:border-transparent outline-none transition"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-ordinex-400 focus:border-transparent outline-none transition"
                placeholder={isLogin ? 'Your password' : 'At least 8 characters'}
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-ordinex-600 hover:bg-ordinex-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
