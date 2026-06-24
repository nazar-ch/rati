import { Link, useRouteContext } from 'rati';
import type { Profile } from '../data';

// Matches the resolved shape of `profileScope` (routes.tsx).
interface ProfilePageProps {
    userId: string;
    profile: Profile;
}

// Nested deep in the page and given no props: it reads the route's resolved data by
// name through the scope channel. `useRouteContext` (rather than `useScope`) avoids
// importing the page's scope — which, from a child of the route, would be a cycle.
function ProfileBadge() {
    const { userId, profile } = useRouteContext('profile');
    return (
        <div className="note">
            <span className="badge server">channel</span> This badge is nested several levels deep
            and got <code>{profile.name}</code> (user {userId}) from{' '}
            <code>useRouteContext(&apos;profile&apos;)</code> — no props drilled down, no import of
            the page’s scope, and it is server-rendered.
        </div>
    );
}

export function ProfilePage({ userId, profile }: ProfilePageProps) {
    return (
        <article className="page">
            <h1>{profile.name}</h1>
            <p className="muted">
                joined {profile.joined} · id {userId}
            </p>
            <p className="lead">{profile.bio}</p>

            <section className="deep">
                <div className="deep">
                    <div className="deep">
                        <ProfileBadge />
                    </div>
                </div>
            </section>

            <div className="row">
                <span className="muted">Other profiles:</span>
                <Link to={{ name: 'profile', userId: '1' }}>#1</Link>
                <Link to={{ name: 'profile', userId: '7' }}>#7</Link>
                <Link to={{ name: 'profile', userId: '42' }}>#42</Link>
            </div>
        </article>
    );
}
