import { exigirPerfil } from "@/lib/auth";
import { sair } from "@/app/login/actions";
import { MenuLateral } from "@/components/MenuLateral";
import { ROTULO_PAPEL, type Papel } from "@/types/database";

interface ItemNav {
  href: string;
  rotulo: string;
  papeis: Papel[];
}

// Navegação principal, filtrada por papel
const ITENS_NAV: ItemNav[] = [
  { href: "/", rotulo: "Dashboard", papeis: ["ADMIN", "MANAGER", "SELLER"] },
  { href: "/campanhas", rotulo: "Campanhas", papeis: ["ADMIN", "MANAGER", "SELLER"] },
  { href: "/vendedores", rotulo: "Vendedores", papeis: ["ADMIN", "MANAGER"] },
  { href: "/clientes", rotulo: "Clientes", papeis: ["ADMIN", "MANAGER", "SELLER"] },
  { href: "/atencao", rotulo: "Atenção", papeis: ["ADMIN", "MANAGER", "SELLER"] },
  { href: "/uploads", rotulo: "Uploads", papeis: ["ADMIN", "MANAGER"] },
  { href: "/pendencias", rotulo: "Pendências", papeis: ["ADMIN", "MANAGER"] },
  { href: "/administracao", rotulo: "Administração", papeis: ["ADMIN"] },
];

export default async function LayoutApp({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const perfil = await exigirPerfil();
  const itens = ITENS_NAV.filter((i) => i.papeis.includes(perfil.role)).map(
    ({ href, rotulo }) => ({ href, rotulo })
  );

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <MenuLateral
        itens={itens}
        nome={perfil.name}
        papel={ROTULO_PAPEL[perfil.role]}
        aoSair={sair}
      />
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        {children}
      </main>
    </div>
  );
}
