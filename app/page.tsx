export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Bienvenue sur Popoth App
        </h1>
        <p className="text-gray-600 mb-6">
          Votre application mobile moderne construite avec Next.js 15 et Supabase
        </p>
        <div className="space-y-3">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-green-800 text-sm font-medium">
              ✅ Next.js 15 configuré
            </p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-blue-800 text-sm font-medium">
              🎨 Tailwind CSS & shadcn/ui prêts
            </p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-green-800 text-sm font-medium">
              ✅ Supabase configuré et prêt
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}