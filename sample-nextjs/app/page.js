import Image from "next/image";
import Link from "next/link";
import heroBanner from "./hero-banner.jpg";

export default function HomePage() {
    const products = [{ id: 1, name: "Wallet" }];

    return (
        <main>
            <h1>Demo shop</h1>
            <Image src={heroBanner} priority />
            <img src="/team-photo.png" className="team" />
            <img src="/IMG_0042.jpg" style={{ borderRadius: 8 }} />
            {products.map(product => <p key={product.id}>{product.name}</p>)}
            <a href="https://partner.example.com" target="_blank">Partner</a>
            <Link href="/about">About</Link>
        </main>
    );
}
