import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CheckCircle, Smartphone, Database, Palette } from "lucide-react";

export default function Home() {
  const features = [
    {
      icon: <Smartphone className="h-6 w-6" />,
      title: "Next.js 15",
      description: "App Router avec TypeScript"
    },
    {
      icon: <Palette className="h-6 w-6" />,
      title: "Design moderne",
      description: "Tailwind CSS + shadcn/ui"
    },
    {
      icon: <Database className="h-6 w-6" />,
      title: "Supabase",
      description: "Base de données et authentification"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center space-y-8 mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            <CheckCircle className="h-4 w-4" />
            Application initialisée avec succès
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground">
            Bienvenue sur{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Popoth App
            </span>
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Une application mobile moderne prête pour le développement avec toutes les technologies les plus récentes.
          </p>

          <Button size="lg" className="mt-6">
            Commencer
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {features.map((feature, index) => (
            <Card key={index} className="text-center">
              <CardHeader>
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">
            Prêt à développer votre prochaine application mobile !
          </p>
        </div>
      </div>
    </div>
  );
}