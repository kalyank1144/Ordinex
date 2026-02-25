import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function ApiKeysSection() {
  const [keys, setKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    try {
      const { keys } = await api.account.keys();
      setKeys(keys);
    } catch {
      // handle silently
    }
  }

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const { key } = await api.account.createKey(newKeyName.trim());
      setCreatedKey(key.rawKey);
      setNewKeyName('');
      await loadKeys();
    } catch {
      // handle silently
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(keyId: string) {
    try {
      await api.account.deleteKey(keyId);
      await loadKeys();
    } catch {
      // handle silently
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">API Keys</h3>

      {createdKey && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 font-medium mb-1">Key created! Copy it now — it won't be shown again.</p>
          <code className="text-xs bg-green-100 px-2 py-1 rounded block break-all">
            {createdKey}
          </code>
          <button
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-green-600 hover:text-green-700"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newKeyName}
          onChange={e => setNewKeyName(e.target.value)}
          placeholder="Key name (e.g. Desktop App)"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-ordinex-400 focus:border-transparent outline-none"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newKeyName.trim()}
          className="px-4 py-2 bg-ordinex-600 hover:bg-ordinex-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          Create
        </button>
      </div>

      {keys.length === 0 ? (
        <p className="text-gray-400 text-sm">No API keys yet.</p>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{key.name}</p>
                <p className="text-xs text-gray-500">
                  {key.keyPrefix}... &middot; Created {new Date(key.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(key.id)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
