import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { TituloPagina } from "@/components/EstadoVazio";

export default async function PaginaAdministracao() {
  await exigirPerfil(["ADMIN"]);

  const cartoes = [
    {
      href: "/administracao/usuarios",
      titulo: "Usuários",
      descricao: "Cadastrar contas, definir papéis e ativar/inativar acessos.",
    },
    {
      href: "/administracao/auditoria",
      titulo: "Auditoria",
      descricao: "Consultar o registro imutável de ações administrativas.",
    },
  ];

  return (
    <div>
      <TituloPagina titulo="Administração" />
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        {cartoes.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-slate-200 bg-white p-5 hover:border-blue-400 hover:shadow-sm"
          >
            <p className="font-medium text-slate-900">{c.titulo}</p>
            <p className="mt-1 text-sm text-slate-500">{c.descricao}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
